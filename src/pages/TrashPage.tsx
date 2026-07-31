import { useState } from 'react'
import { Archive, ArchiveRestore, RotateCcw, Trash2, XCircle } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useApp } from '../state/AppContext'
import './workspace-pages.css'

export function TrashPage() {
  const { state, restoreTask, permanentlyRemoveTask, restoreArchivedTask } = useApp()
  const [mode, setMode] = useState<'trash' | 'archive'>('trash')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const deleted = state.tasks.filter((task) => task.status === 'deleted').sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))
  const archived = state.tasks.filter((task) => task.status === 'archived').sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
  const tasks = mode === 'trash' ? deleted : archived

  const emptyTrash = () => {
    deleted.forEach((task) => permanentlyRemoveTask(task.id))
    setConfirmEmpty(false)
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="Безопасное хранение"
        title={mode === 'trash' ? 'Корзина' : 'Архив'}
        description={mode === 'trash' ? 'Удалённые задачи можно восстановить' : 'Завершённые задачи вне активных списков'}
      />

      <section className="trash-toolbar">
        <div className="segmented">
          <button className={mode === 'trash' ? 'is-selected' : ''} onClick={() => setMode('trash')}><Trash2 size={15} /> Корзина <em>{deleted.length}</em></button>
          <button className={mode === 'archive' ? 'is-selected' : ''} onClick={() => setMode('archive')}><Archive size={15} /> Архив <em>{archived.length}</em></button>
        </div>
        {mode === 'trash' && deleted.length > 0 && (
          confirmEmpty
            ? <span className="trash-confirm"><strong>Удалить всё навсегда?</strong><button onClick={emptyTrash}>Да</button><button onClick={() => setConfirmEmpty(false)}>Нет</button></span>
            : <button className="button button--danger-ghost" onClick={() => setConfirmEmpty(true)}>Очистить корзину</button>
        )}
      </section>

      <section className="trash-list">
        {tasks.map((task) => (
          <article className="trash-task" key={task.id}>
            <span className="trash-task__icon">{mode === 'trash' ? <Trash2 size={18} /> : <Archive size={18} />}</span>
            <div><strong>{task.title}</strong><small>{mode === 'trash' ? `Удалено ${formatDate(task.deletedAt)}` : `Архивировано ${formatDate(task.archivedAt)}`}</small></div>
            {mode === 'trash' ? (
              <>
                <button className="button button--ghost" onClick={() => restoreTask(task.id)}><RotateCcw size={15} /> Восстановить</button>
                <button className="button button--danger-ghost" onClick={() => confirmId === task.id ? permanentlyRemoveTask(task.id) : setConfirmId(task.id)}>
                  <XCircle size={15} /> {confirmId === task.id ? 'Подтвердить удаление' : 'Удалить навсегда'}
                </button>
              </>
            ) : (
              <button className="button button--ghost" onClick={() => restoreArchivedTask(task.id)}><ArchiveRestore size={15} /> Вернуть</button>
            )}
          </article>
        ))}
      </section>

      {tasks.length === 0 && (
        <div className="empty-state workspace-empty">
          <span>{mode === 'trash' ? <Trash2 /> : <Archive />}</span>
          <h2>{mode === 'trash' ? 'Корзина пуста' : 'Архив пуст'}</h2>
          <p>{mode === 'trash' ? 'Удалённые задачи появятся здесь.' : 'Завершите задачи и отправьте их в архив.'}</p>
        </div>
      )}
    </main>
  )
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'недавно'
}
