import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bell, Clock3, FileImage, Flag, Folder, Paperclip, Plus, Trash2, X } from 'lucide-react'
import type { Attachment, Importance, Task, Urgency } from '../domain/models'
import { parseVoiceTask, type ParsedVoiceTask } from '../domain/voiceParser'
import { useApp } from '../state/AppContext'
import { AttachmentViewer } from './AttachmentViewer'
import { DateTimePicker } from './DateTimePicker'
import { setInert, trapTabKey } from './focusTrap'
import { SelectMenu } from './SelectMenu'
import { VoiceCaptureButton } from './VoiceCaptureButton'
import './task-editor-enhancements.css'

const localInput = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
const toIso = (value: string) => (value ? new Date(value).toISOString() : undefined)

export function TaskEditor({
  task,
  defaults,
  onClose,
}: {
  task?: Task
  defaults?: Partial<Pick<Task, 'startAt' | 'deadline'>>
  onClose: () => void
}) {
  const { state, addTask, updateTask, removeTask } = useApp()
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [projectId, setProjectId] = useState(task?.projectId ?? 'inbox')
  const [startAt, setStartAt] = useState(localInput(task?.startAt ?? defaults?.startAt))
  const [deadline, setDeadline] = useState(localInput(task?.deadline ?? defaults?.deadline))
  const [startAtValid, setStartAtValid] = useState(true)
  const [deadlineValid, setDeadlineValid] = useState(true)
  const [importance, setImportance] = useState<Importance>(task?.importance ?? 'low')
  const [urgencyOverride, setUrgencyOverride] = useState<Urgency | ''>(task?.urgencyOverride ?? '')
  const [threshold, setThreshold] = useState(task?.urgencyThresholdHours ?? state.settings.defaultUrgencyThresholdHours)
  const [tags, setTags] = useState(task?.tags.join(', ') ?? '')
  const [subtasks, setSubtasks] = useState(task?.subtasks ?? [])
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [reminders, setReminders] = useState(task?.reminders ?? [])
  const [attachments, setAttachments] = useState<Attachment[]>(task?.attachments ?? [])
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  const [voiceFallback, setVoiceFallback] = useState(false)
  const [voiceCommand, setVoiceCommand] = useState('')
  const [voicePreview, setVoicePreview] = useState<ParsedVoiceTask | null>(null)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)

  useLayoutEffect(() => {
    titleRef.current?.focus()
    return () => {
      requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
      })
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    setInert([editor], Boolean(previewAttachment))
    return () => setInert([editor], false)
  }, [previewAttachment])

  const uniqueTags = useMemo(
    () =>
      tags
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter((tag, index, array) => tag && array.indexOf(tag) === index),
    [tags],
  )

  const save = () => {
    if (!title.trim()) {
      setError('Добавьте название задачи')
      titleRef.current?.focus()
      return
    }
    if (!startAtValid || !deadlineValid) {
      setError('Исправьте дату и время перед сохранением')
      editorRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
      return
    }
    const now = new Date().toISOString()
    const nextTask: Task = {
      id: task?.id ?? crypto.randomUUID(),
      title: title.trim(),
      description: description.trim(),
      projectId,
      startAt: toIso(startAt),
      deadline: toIso(deadline),
      importance,
      urgencyThresholdHours: Number(threshold) || 72,
      urgencyOverride: urgencyOverride || undefined,
      tags: uniqueTags,
      subtasks,
      attachments,
      reminders,
      status: task?.status ?? 'active',
      createdAt: task?.createdAt ?? now,
      updatedAt: now,
      completedAt: task?.completedAt,
      archivedAt: task?.archivedAt,
      deletedAt: task?.deletedAt,
      previousStatus: task?.previousStatus,
      focusMinutes: task?.focusMinutes ?? 0,
    }
    if (task) updateTask(nextTask)
    else addTask(nextTask)
    onClose()
  }

  const addSubtask = () => {
    if (!subtaskTitle.trim()) return
    setSubtasks([...subtasks, { id: crypto.randomUUID(), title: subtaskTitle.trim(), completed: false }])
    setSubtaskTitle('')
  }

  const addReminder = () => {
    if (reminders.length >= 5) return
    const base = deadline ? new Date(deadline) : new Date(Date.now() + 3_600_000)
    base.setHours(base.getHours() - 1)
    setReminders([...reminders, { id: crypto.randomUUID(), at: base.toISOString() }])
  }

  const readFiles = async (files: FileList | null) => {
    if (!files) return
    const next: Attachment[] = []
    for (const file of Array.from(files).slice(0, 5 - attachments.length)) {
      if (file.size > 1_000_000) {
        setError(`Файл «${file.name}» больше лимита MVP 1 МБ`)
        continue
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      next.push({ id: crypto.randomUUID(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl })
    }
    setAttachments([...attachments, ...next])
  }

  const previewVoiceTranscript = (transcript: string) => {
    setVoicePreview(parseVoiceTask(transcript))
  }

  const applyVoicePreview = () => {
    if (!voicePreview) return
    const parsed = voicePreview
    if (parsed.title) setTitle(parsed.title)
    if (parsed.deadline) setDeadline(localInput(parsed.deadline))
    if (parsed.importance) setImportance(parsed.importance)
    if (parsed.tags.length) {
      const existing = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      setTags([...new Set([...existing, ...parsed.tags])].join(', '))
    }
    if (parsed.projectHint) {
      const project = state.projects.find((item) => item.name.toLowerCase().includes(parsed.projectHint!.toLowerCase()))
      if (project) setProjectId(project.id)
    }
    setVoiceFallback(false)
    setVoiceCommand('')
    setVoicePreview(null)
  }

  const readClipboardFiles = (event: React.ClipboardEvent) => {
    const files = event.clipboardData.files
    if (files.length > 0) void readFiles(files)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={editorRef}
        className="task-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
        tabIndex={-1}
        onKeyDown={(event) => trapTabKey(event, editorRef.current)}
        onPaste={readClipboardFiles}
      >
        <header className="task-editor__header">
          <div>
            <span className="eyebrow">{task ? 'Редактирование' : 'Новая задача'}</span>
            <h2 id="task-editor-title">{task ? task.title : 'Что нужно сделать?'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть редактор">
            <X />
          </button>
        </header>

        <div className="task-editor__content">
          <div className="field field--full">
            <span className="field__label-row">
              <label htmlFor="task-title">Название</label>
              <VoiceCaptureButton onTranscript={previewVoiceTranscript} onUnavailable={() => setVoiceFallback(true)} />
            </span>
            <input id="task-title" ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, подготовить отчёт" />
          </div>
          {voiceFallback && (
            <div className="voice-fallback field--full">
              <div><strong>Голосовой ввод недоступен в этом браузере</strong><small>Введите фразу так, как произнесли бы её: «Позвонить врачу завтра в 10 важно #здоровье».</small></div>
              <div>
                <input aria-label="Фраза для разбора задачи" value={voiceCommand} onChange={(event) => setVoiceCommand(event.target.value)} placeholder="Введите команду…" />
                <button type="button" className="button button--ghost" onClick={() => voiceCommand.trim() && previewVoiceTranscript(voiceCommand)}>Разобрать</button>
              </div>
            </div>
          )}
          {voicePreview && (
            <div className="voice-preview field--full" aria-label="Предпросмотр распознанной задачи">
              <div>
                <span className="eyebrow">Распознано</span>
                <strong>{voicePreview.title}</strong>
                <span className="voice-preview__chips">
                  {voicePreview.deadline && <em>{new Date(voicePreview.deadline).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</em>}
                  {voicePreview.importance === 'high' && <em>Важно</em>}
                  {voicePreview.projectHint && <em>{voicePreview.projectHint}</em>}
                  {voicePreview.tags.map((tag) => <em key={tag}>#{tag}</em>)}
                </span>
              </div>
              <div><button type="button" className="button button--ghost" onClick={() => setVoicePreview(null)}>Отмена</button><button type="button" className="button button--primary" onClick={applyVoicePreview}>Применить</button></div>
            </div>
          )}
          <label className="field field--full">
            <span>Дополнительный текст</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Контекст, ссылки и заметки…" rows={3} />
          </label>
          <div className="field">
            <span>Проект</span>
            <SelectMenu<string>
              label="Проект"
              value={projectId}
              onChange={setProjectId}
              searchable
              options={state.projects.map((project) => ({
                value: project.id,
                label: project.name,
                description: project.id === 'inbox' ? 'Задача останется без проекта' : project.description,
                color: project.color,
                icon: <Folder size={17} />,
              }))}
            />
          </div>
          <div className="field">
            <span>Важность</span>
            <SelectMenu<Importance>
              label="Важность"
              value={importance}
              onChange={setImportance}
              options={[
                { value: 'low', label: 'Обычная', description: 'Спокойный приоритет по умолчанию', icon: <Flag size={17} /> },
                { value: 'high', label: 'Важная', description: 'Выделяется флагом и попадает в приоритеты', icon: <Flag size={17} fill="currentColor" /> },
              ]}
            />
          </div>
          <DateTimePicker label="Начало" value={startAt} onChange={setStartAt} onValidityChange={setStartAtValid} defaultTime="09:00" />
          <DateTimePicker label="Дедлайн" value={deadline} onChange={setDeadline} onValidityChange={setDeadlineValid} defaultTime="18:00" />
          <div className="field">
            <span>Становится срочной за</span>
            <SelectMenu<number>
              label="Порог срочности"
              value={threshold}
              onChange={setThreshold}
              options={[
                { value: 1, label: '1 час', description: 'Только перед самым сроком', icon: <Clock3 size={17} /> },
                { value: 24, label: '1 день', icon: <Clock3 size={17} /> },
                { value: 72, label: '3 дня', description: 'Рекомендуемое значение', icon: <Clock3 size={17} /> },
                { value: 168, label: '7 дней', icon: <Clock3 size={17} /> },
                { value: 336, label: '14 дней', icon: <Clock3 size={17} /> },
              ]}
            />
          </div>
          <div className="field">
            <span>Срочность вручную</span>
            <SelectMenu<Urgency | ''>
              label="Срочность вручную"
              value={urgencyOverride}
              onChange={setUrgencyOverride}
              options={[
                { value: '', label: 'Автоматически', description: 'Рассчитать по дедлайну', icon: <Clock3 size={17} /> },
                { value: 'low', label: 'Не срочно', icon: <Clock3 size={17} /> },
                { value: 'high', label: 'Срочно', description: 'Всегда показывать как срочную', icon: <Clock3 size={17} /> },
              ]}
            />
          </div>
          <label className="field field--full">
            <span>Теги через запятую</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="работа, фокус, звонки" />
          </label>

          <div className="editor-section">
            <div className="editor-section__title"><span>Подзадачи</span><small>{subtasks.filter((item) => item.completed).length}/{subtasks.length}</small></div>
            {subtasks.map((subtask) => (
              <label className="subtask-row" key={subtask.id}>
                <input
                  type="checkbox"
                  checked={subtask.completed}
                  onChange={() => setSubtasks(subtasks.map((item) => item.id === subtask.id ? { ...item, completed: !item.completed } : item))}
                />
                <span>{subtask.title}</span>
                <button type="button" className="icon-button" onClick={() => setSubtasks(subtasks.filter((item) => item.id !== subtask.id))} aria-label={`Удалить подзадачу ${subtask.title}`}>
                  <X size={15} />
                </button>
              </label>
            ))}
            <div className="inline-add">
              <input value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addSubtask())} placeholder="Добавить подзадачу" />
              <button type="button" className="icon-button" onClick={addSubtask} aria-label="Добавить подзадачу"><Plus size={18} /></button>
            </div>
          </div>

          <div className="editor-section">
            <div className="editor-section__title">
              <span>Напоминания</span>
              <button type="button" className="text-button" onClick={addReminder} disabled={reminders.length >= 5}>
                <Bell size={15} /> {reminders.length >= 5 ? 'Лимит 5' : 'Добавить'}
              </button>
            </div>
            {reminders.length === 0 && <p className="empty-inline">Напоминаний пока нет</p>}
            {reminders.map((reminder) => (
              <div className="reminder-row" key={reminder.id}>
                <input
                  aria-label="Время напоминания"
                  type="datetime-local"
                  value={localInput(reminder.at)}
                  onChange={(event) => setReminders(reminders.map((item) => item.id === reminder.id ? { ...item, at: toIso(event.target.value) ?? item.at } : item))}
                />
                <button type="button" className="icon-button" onClick={() => setReminders(reminders.filter((item) => item.id !== reminder.id))} aria-label="Удалить напоминание"><X size={15} /></button>
              </div>
            ))}
          </div>

          <div
            className="editor-section attachment-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void readFiles(event.dataTransfer.files)
            }}
          >
            <div className="editor-section__title">
              <span>Файлы и изображения</span>
              <button type="button" className="text-button" disabled={attachments.length >= 5} onClick={() => fileRef.current?.click()}>
                <Paperclip size={15} /> {attachments.length >= 5 ? 'Лимит 5' : 'Прикрепить'}
              </button>
            </div>
            <input ref={fileRef} hidden type="file" multiple accept="image/*,.pdf,.txt,.md" onChange={(event) => void readFiles(event.target.files)} />
            {attachments.length === 0 && <p className="empty-inline">До 5 файлов по 1 МБ в MVP</p>}
            <div className="attachment-grid">
              {attachments.map((file) => (
                <div className="attachment" key={file.id}>
                  <button type="button" className="attachment__preview" onClick={() => setPreviewAttachment(file)} aria-label={`Просмотреть ${file.name}`}>
                    {file.type.startsWith('image/') && file.dataUrl ? <img src={file.dataUrl} alt="" /> : <FileImage size={20} />}
                    <span title={file.name}>{file.name}</span>
                  </button>
                  <button type="button" className="icon-button" onClick={() => setAttachments(attachments.filter((item) => item.id !== file.id))} aria-label={`Удалить файл ${file.name}`}><X size={14} /></button>
                </div>
              ))}
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
        </div>

        <footer className="task-editor__footer">
          {task ? (
            <button className="button button--danger-ghost" onClick={() => { removeTask(task.id); onClose() }}><Trash2 size={17} /> В корзину</button>
          ) : <span />}
          <div>
            <button className="button button--ghost" onClick={onClose}>Отмена</button>
            <button className="button button--primary" onClick={save}>{task ? 'Сохранить' : 'Создать задачу'}</button>
          </div>
        </footer>
      </section>
      {previewAttachment && <AttachmentViewer attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />}
    </div>
  )
}
