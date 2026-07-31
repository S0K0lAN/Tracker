import { useMemo, useState } from 'react'
import { Filter, Plus, Target, Zap } from 'lucide-react'
import type { Importance, Task, Urgency } from '../domain/models'
import { getTaskUrgency } from '../domain/models'
import { useApp } from '../state/AppContext'
import { PageHeader } from '../components/PageHeader'
import { SelectMenu } from '../components/SelectMenu'

interface Quadrant {
  importance: Importance
  urgency: Urgency
  number: string
  title: string
  action: string
  description: string
}

const quadrants: Quadrant[] = [
  { importance: 'high', urgency: 'high', number: '01', title: 'Важно и срочно', action: 'Сделать', description: 'Начните с этих задач' },
  { importance: 'high', urgency: 'low', number: '02', title: 'Важно, не срочно', action: 'Запланировать', description: 'Защитите время для фокуса' },
  { importance: 'low', urgency: 'high', number: '03', title: 'Не важно, срочно', action: 'Сократить', description: 'Упростите или автоматизируйте' },
  { importance: 'low', urgency: 'low', number: '04', title: 'Не важно, не срочно', action: 'Отложить', description: 'Пересмотрите необходимость' },
]

export function MatrixPage({ onEditTask }: { onEditTask: (task: Task | null) => void }) {
  const { state } = useApp()
  const [project, setProject] = useState('all')
  const activeTasks = useMemo(
    () => state.tasks.filter((task) => task.status === 'active' && (project === 'all' || task.projectId === project)),
    [project, state.tasks],
  )

  return (
    <main className="page page--wide">
      <PageHeader
        eyebrow="Приоритеты без шума"
        title="Матрица Эйзенхауэра"
        description="Срочность рассчитывается по дедлайну, важность задаёте вы"
        actions={<button className="button button--primary" onClick={() => onEditTask(null)}><Plus size={18} /> Добавить</button>}
      />
      <section className="matrix-toolbar">
        <div className="axis-legend">
          <span><Zap size={15} /> Срочность: автоматически</span>
          <span><Target size={15} /> Важность: вручную</span>
        </div>
        <div className="matrix-project-filter"><Filter size={16} />
          <SelectMenu<string>
            label="Проект в матрице"
            value={project}
            onChange={setProject}
            searchable
            options={[
              { value: 'all', label: 'Все проекты' },
              ...state.projects.filter((item) => item.id !== 'inbox').map((item) => ({ value: item.id, label: item.name, color: item.color })),
            ]}
          />
        </div>
      </section>
      <section className="matrix-grid">
        {quadrants.map((quadrant) => {
          const tasks = activeTasks.filter((task) => task.importance === quadrant.importance && getTaskUrgency(task) === quadrant.urgency)
          return (
            <article className={`quadrant quadrant--${quadrant.number}`} key={quadrant.number}>
              <header className="quadrant__header">
                <span className="quadrant__number">{quadrant.number}</span>
                <div><h2>{quadrant.title}</h2><p>{quadrant.description}</p></div>
                <span className="quadrant__action">{quadrant.action}</span>
              </header>
              <div className="quadrant__tasks">
                {tasks.map((task) => (
                  <button className="matrix-task" key={task.id} onClick={() => onEditTask(task)}>
                    <span className={`matrix-task__dot matrix-task__dot--${task.importance}`} />
                    <span><strong>{task.title}</strong><small>{state.projects.find((item) => item.id === task.projectId)?.name}</small></span>
                    {task.deadline && <time>{new Date(task.deadline).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</time>}
                  </button>
                ))}
                {tasks.length === 0 && <button className="quadrant__empty" onClick={() => onEditTask(null)}><Plus size={16} /> Добавить задачу</button>}
              </div>
            </article>
          )
        })}
      </section>
    </main>
  )
}
