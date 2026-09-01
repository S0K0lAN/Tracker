import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bell, Clock3, FileImage, Flag, Folder, Paperclip, Plus, Trash2, X } from 'lucide-react'
import type { Attachment, Importance, Task, Urgency } from '../domain/models'
import {
  DEFAULT_PLANNED_DURATION_MINUTES,
  DEFAULT_URGENCY_THRESHOLD_HOURS,
  MAX_PLANNED_DURATION_MINUTES,
} from '../domain/models'
import { INPUT_LIMITS } from '../domain/inputLimits'
import { taskTimingMutationRequiresStart } from '../domain/taskTimingPolicy'
import { parseVoiceTask, type ParsedVoiceTask } from '../domain/voiceParser'
import { useApp } from '../state/AppContext'
import { AttachmentViewer } from './AttachmentViewer'
import { DateTimePicker } from './DateTimePicker'
import { setInert, trapTabKey } from './focusTrap'
import { SelectMenu } from './SelectMenu'
import {
  clearTaskDraft,
  clearTaskDraftIfMatches,
  readTaskDraft,
  TASK_DRAFT_DEBOUNCE_MS,
  TASK_DRAFT_MAX_REMINDERS,
  TASK_DRAFT_MAX_SUBTASKS,
  taskDraftsEqual,
  writeTaskDraft,
  type TaskDraftData,
  type TaskDraftWriteResult,
} from './taskDraftJournal'
import { VoiceCaptureButton, VoiceCaptureFailureNotice, type VoiceCaptureFailure } from './VoiceCaptureButton'
import './task-editor-enhancements.css'

const localInput = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
const toIso = (value: string) => (value ? new Date(value).toISOString() : undefined)
const DURATION_RANGE_ERROR = 'Укажите длительность от 1 минуты до 24 часов'
const DURATION_DAY_ERROR_PREFIX = 'Длительность выходит за пределы дня.'
const DEADLINE_REQUIRES_START_ERROR = 'Сначала укажите корректное начало задачи, затем дедлайн'
const START_REQUIRED_BY_DEADLINE_ERROR = 'Сначала уберите дедлайн, затем очистите начало'
type DurationUnit = 'minutes' | 'hours'

const parseDurationMinutes = (value: string, unit: DurationUnit): number | '' => {
  if (!value.trim()) return ''
  const amount = Number(value.replace(',', '.'))
  if (!Number.isFinite(amount)) return ''
  return unit === 'hours' ? Math.round(amount * 60) : amount
}

const formatDurationInput = (minutes: number, unit: DurationUnit) => (
  unit === 'hours' ? String(Number((minutes / 60).toFixed(4))) : String(minutes)
)

const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours && remainder) return `${hours} ч ${remainder} мин`
  if (hours) return `${hours} ч`
  return `${remainder} мин`
}

const maxDurationUntilLocalMidnight = (startAt: string) => {
  if (!startAt) return MAX_PLANNED_DURATION_MINUTES
  const start = new Date(startAt)
  if (!Number.isFinite(start.getTime())) return MAX_PLANNED_DURATION_MINUTES
  const nextMidnight = new Date(start)
  nextMidnight.setHours(24, 0, 0, 0)
  return Math.min(
    MAX_PLANNED_DURATION_MINUTES,
    Math.max(0, Math.floor((nextMidnight.getTime() - start.getTime()) / 60_000)),
  )
}

const isDurationError = (value: string) => (
  value === DURATION_RANGE_ERROR || value.startsWith(DURATION_DAY_ERROR_PREFIX)
)
const isTimingError = (value: string) => (
  value === DEADLINE_REQUIRES_START_ERROR || value === START_REQUIRED_BY_DEADLINE_ERROR
)
const urgencyThresholdPresets = [
  { value: 1, label: '1 час', description: 'Только перед самым сроком' },
  { value: 24, label: '1 день' },
  { value: 72, label: '3 дня', description: 'Рекомендуемое значение' },
  { value: 168, label: '7 дней' },
  { value: 336, label: '14 дней' },
]

const formatUrgencyThreshold = (hours: number) => (
  urgencyThresholdPresets.find((preset) => preset.value === hours)?.label ?? `${hours} ч`
)

function createInitialDraft(
  task: Task | undefined,
  defaults: Partial<Pick<Task, 'projectId' | 'startAt' | 'deadline' | 'plannedDurationMinutes'>> | undefined,
): TaskDraftData {
  const deadline = localInput(task?.deadline ?? defaults?.deadline)
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    projectId: task?.projectId ?? defaults?.projectId ?? 'inbox',
    startAt: localInput(task?.startAt ?? defaults?.startAt),
    deadline,
    plannedDurationMinutes: task?.plannedDurationMinutes ?? defaults?.plannedDurationMinutes ?? DEFAULT_PLANNED_DURATION_MINUTES,
    importance: task?.importance ?? 'low',
    urgencyThresholdOverrideHours: deadline ? task?.urgencyThresholdOverrideHours ?? '' : '',
    urgencyOverride: deadline ? task?.urgencyOverride ?? '' : '',
    tags: task?.tags.join(', ') ?? '',
    subtasks: task?.subtasks ?? [],
    pendingSubtaskTitle: '',
    reminders: task?.reminders ?? [],
  }
}

export function TaskEditor({
  task,
  defaults,
  onClose,
}: {
  task?: Task
  defaults?: Partial<Pick<Task, 'projectId' | 'startAt' | 'deadline' | 'plannedDurationMinutes'>>
  onClose: () => void
}) {
  const { state, saveTaskDurably, trashTaskDurably } = useApp()
  const [initialDraft] = useState(() => createInitialDraft(task, defaults))
  const [title, setTitle] = useState(initialDraft.title)
  const [description, setDescription] = useState(initialDraft.description)
  const [projectId, setProjectId] = useState(initialDraft.projectId)
  const [startAt, setStartAt] = useState(initialDraft.startAt)
  const [deadline, setDeadline] = useState(initialDraft.deadline)
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('minutes')
  const [durationInput, setDurationInput] = useState(formatDurationInput(initialDraft.plannedDurationMinutes || DEFAULT_PLANNED_DURATION_MINUTES, 'minutes'))
  const [startAtValid, setStartAtValid] = useState(true)
  const [startAtDraftPresent, setStartAtDraftPresent] = useState(Boolean(initialDraft.startAt))
  const [deadlineValid, setDeadlineValid] = useState(true)
  const [dateInputResetToken, setDateInputResetToken] = useState(0)
  const [importance, setImportance] = useState<Importance>(initialDraft.importance)
  const [urgencyOverride, setUrgencyOverride] = useState<Urgency | ''>(initialDraft.urgencyOverride)
  const [thresholdOverride, setThresholdOverride] = useState(initialDraft.urgencyThresholdOverrideHours)
  const [tags, setTags] = useState(initialDraft.tags)
  const [subtasks, setSubtasks] = useState(initialDraft.subtasks)
  const [subtaskTitle, setSubtaskTitle] = useState(initialDraft.pendingSubtaskTitle)
  const [reminders, setReminders] = useState(initialDraft.reminders)
  const [attachments, setAttachments] = useState<Attachment[]>(task?.attachments ?? [])
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null)
  const [voiceFailure, setVoiceFailure] = useState<VoiceCaptureFailure>()
  const [voiceCommand, setVoiceCommand] = useState('')
  const [voicePreview, setVoicePreview] = useState<ParsedVoiceTask | null>(null)
  const [error, setError] = useState('')
  const [committing, setCommitting] = useState(false)
  const [draftStorageMessage, setDraftStorageMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [recoveryDraft, setRecoveryDraft] = useState(() => {
    const loaded = readTaskDraft(task?.id, task?.updatedAt)
    if (loaded && taskDraftsEqual(loaded.data, initialDraft)) {
      clearTaskDraft(task?.id)
      return null
    }
    return loaded
  })
  const [journalPresent, setJournalPresent] = useState(Boolean(recoveryDraft))
  const fileRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const durationRef = useRef<HTMLInputElement>(null)
  const restoreDraftRef = useRef<HTMLButtonElement>(null)
  const editorRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null)
  const suppressDraftWriteRef = useRef(false)
  const latestJournalTokenRef = useRef(recoveryDraft?.token)
  const commitInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const stableTaskIdRef = useRef(task?.id ?? crypto.randomUUID())
  const stableCreatedAtRef = useRef(task?.createdAt ?? new Date().toISOString())

  useLayoutEffect(() => {
    if (recoveryDraft) restoreDraftRef.current?.focus()
    else titleRef.current?.focus()
    return () => {
      requestAnimationFrame(() => {
        if (returnFocusRef.current?.isConnected) {
          returnFocusRef.current.focus()
          return
        }
        if (document.querySelector('[role="dialog"]')) return
        const fallback = document.querySelector<HTMLElement>('.workspace main h1, .workspace main h2')
        if (fallback) {
          fallback.tabIndex = -1
          fallback.focus()
        }
      })
    }
  }, [])

  useEffect(() => () => { mountedRef.current = false }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    setInert([editor], Boolean(previewAttachment))
    return () => setInert([editor], false)
  }, [previewAttachment])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    const fields = [...content.children].filter((element) => !element.hasAttribute('data-task-draft-recovery'))
    setInert(fields, Boolean(recoveryDraft))
    return () => setInert(fields, false)
  }, [recoveryDraft])

  const selectedProject = state.projects.find((project) => project.id === projectId)
  const inheritedThreshold = selectedProject?.urgencyThresholdHours ?? DEFAULT_URGENCY_THRESHOLD_HOURS
  const effectiveThreshold = thresholdOverride === '' ? inheritedThreshold : thresholdOverride
  const lastKnownProjectThresholdRef = useRef<{ id: string; hours: number } | null>(
    selectedProject ? { id: selectedProject.id, hours: selectedProject.urgencyThresholdHours } : null,
  )

  useEffect(() => {
    if (selectedProject) {
      lastKnownProjectThresholdRef.current = {
        id: selectedProject.id,
        hours: selectedProject.urgencyThresholdHours,
      }
      return
    }
    if (projectId === 'inbox') return

    const previousThreshold = lastKnownProjectThresholdRef.current?.id === projectId
      ? lastKnownProjectThresholdRef.current.hours
      : DEFAULT_URGENCY_THRESHOLD_HOURS
    setProjectId('inbox')
    if (deadline) setThresholdOverride((current) => current === '' ? previousThreshold : current)
    setDraftStorageMessage({
      text: deadline
        ? 'Выбранный проект удалён. Задача перенесена во «Входящие», прежний порог срочности сохранён.'
        : 'Выбранный проект удалён. Задача перенесена во «Входящие».',
      error: false,
    })
  }, [deadline, projectId, selectedProject])

  const thresholdOptions = [
    {
      value: 'inherit' as const,
      label: `Из проекта · ${formatUrgencyThreshold(inheritedThreshold)}`,
      description: selectedProject
        ? `Порог проекта «${selectedProject.name}»`
        : 'Резервный системный порог',
      icon: <Folder size={17} />,
    },
    ...(
      thresholdOverride !== ''
      && !urgencyThresholdPresets.some((preset) => preset.value === thresholdOverride)
        ? [{ value: thresholdOverride, label: formatUrgencyThreshold(thresholdOverride), description: 'Индивидуальный порог', icon: <Clock3 size={17} /> }]
        : []
    ),
    ...urgencyThresholdPresets.map((preset) => ({
      ...preset,
      description: preset.description ?? 'Индивидуальный порог',
      icon: <Clock3 size={17} />,
    })),
  ]

  const plannedDurationMinutes = useMemo(
    () => parseDurationMinutes(durationInput, durationUnit),
    [durationInput, durationUnit],
  )
  const maxPlannedDurationMinutes = startAtValid
    ? maxDurationUntilLocalMidnight(startAt)
    : MAX_PLANNED_DURATION_MINUTES
  const durationHasError = isDurationError(error)
  const deadlineLocked = !startAtValid || (!startAt && !startAtDraftPresent)

  const draftData = useMemo<TaskDraftData>(() => ({
    title,
    description,
    projectId,
    startAt,
    deadline,
    plannedDurationMinutes,
    importance,
    urgencyThresholdOverrideHours: deadline ? thresholdOverride : '',
    urgencyOverride: deadline ? urgencyOverride : '',
    tags,
    subtasks,
    pendingSubtaskTitle: subtaskTitle,
    reminders,
  }), [deadline, description, importance, plannedDurationMinutes, projectId, reminders, startAt, subtasks, subtaskTitle, tags, thresholdOverride, title, urgencyOverride])
  const draftDataRef = useRef(draftData)
  const recoveryDraftRef = useRef(recoveryDraft)
  const hasUnsavedChanges = !taskDraftsEqual(draftData, initialDraft)
  draftDataRef.current = draftData
  recoveryDraftRef.current = recoveryDraft

  const persistLatestDraft = useCallback((reportError: boolean, force = false): TaskDraftWriteResult | undefined => {
    if (suppressDraftWriteRef.current || recoveryDraftRef.current || commitInFlightRef.current) return undefined
    const latest = draftDataRef.current
    if (!force && taskDraftsEqual(latest, initialDraft)) {
      const token = latestJournalTokenRef.current
      if (token && clearTaskDraftIfMatches(token)) {
        latestJournalTokenRef.current = undefined
        if (mountedRef.current) setJournalPresent(false)
      }
      return undefined
    }
    const result = writeTaskDraft(latest, task?.id, task?.updatedAt)
    if (result.status === 'saved') {
      latestJournalTokenRef.current = result.token
      if (reportError && mountedRef.current) setJournalPresent(true)
    }
    if (!reportError) return result
    setDraftStorageMessage(result.status === 'too-large'
      ? { text: 'Черновик слишком большой для безопасного локального восстановления.', error: true }
      : result.status === 'unavailable'
        ? { text: 'Не удалось сохранить аварийный черновик в браузере.', error: true }
        : result.status === 'invalid'
          ? { text: 'Черновик содержит слишком много элементов или некорректные данные.', error: true }
        : null)
    return result
  }, [initialDraft, task?.id, task?.updatedAt])

  useEffect(() => {
    if (recoveryDraft) return
    if (taskDraftsEqual(draftData, initialDraft)) {
      persistLatestDraft(false)
      return
    }
    const timeout = window.setTimeout(() => persistLatestDraft(true), TASK_DRAFT_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [draftData, initialDraft, persistLatestDraft, recoveryDraft])

  useEffect(() => {
    const flush = () => persistLatestDraft(false)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [persistLatestDraft])

  const uniqueTags = useMemo(
    () =>
      tags
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter((tag, index, array) => tag && array.indexOf(tag) === index),
    [tags],
  )

  const updateStartAt = (value: string) => {
    if (!value && deadline) {
      setError(START_REQUIRED_BY_DEADLINE_ERROR)
      setStartAtDraftPresent(true)
      setDateInputResetToken((current) => current + 1)
      return
    }
    setStartAt(value)
    setStartAtDraftPresent(Boolean(value))
    setError((current) => isDurationError(current) || isTimingError(current) ? '' : current)
  }

  const updateDeadline = (value: string) => {
    if (value && deadlineLocked) {
      setError(DEADLINE_REQUIRES_START_ERROR)
      editorRef.current?.querySelector<HTMLInputElement>('#task-start-at')?.focus()
      return
    }
    setDeadline(value)
    if (!value) {
      setThresholdOverride('')
      setUrgencyOverride('')
    }
    setError((current) => isTimingError(current) ? '' : current)
  }

  const updateDurationInput = (value: string) => {
    setDurationInput(value)
    setError((current) => isDurationError(current) ? '' : current)
  }

  const updateDurationUnit = (unit: DurationUnit) => {
    const currentMinutes = parseDurationMinutes(durationInput, durationUnit)
    setDurationUnit(unit)
    if (currentMinutes !== '') setDurationInput(formatDurationInput(currentMinutes, unit))
    setError((current) => isDurationError(current) ? '' : current)
  }

  const closePreservingDraft = () => {
    if (commitInFlightRef.current) {
      setDraftStorageMessage({ text: 'Дождитесь завершения локального сохранения.', error: true })
      return
    }
    const result = persistLatestDraft(true)
    if (result && result.status !== 'saved') return
    onClose()
  }

  const discardDraftAndClose = () => {
    if (commitInFlightRef.current) return
    suppressDraftWriteRef.current = true
    clearTaskDraft(task?.id)
    latestJournalTokenRef.current = undefined
    setJournalPresent(false)
    onClose()
  }

  const removeRecoveryDraft = () => {
    if (!recoveryDraft) return
    if (!clearTaskDraftIfMatches(recoveryDraft.token)) {
      const current = readTaskDraft(task?.id, task?.updatedAt)
      recoveryDraftRef.current = current
      setRecoveryDraft(current)
      setDraftStorageMessage({ text: 'Черновик уже обновлён в другой вкладке. Проверьте новую версию.', error: true })
      return
    }
    recoveryDraftRef.current = null
    setRecoveryDraft(null)
    latestJournalTokenRef.current = undefined
    setJournalPresent(false)
    setDraftStorageMessage({ text: 'Аварийный черновик удалён.', error: false })
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const restoreRecoveryDraft = () => {
    if (!recoveryDraft) return
    const recovered = recoveryDraft.data
    setTitle(recovered.title)
    setDescription(recovered.description)
    setProjectId(state.projects.some((project) => project.id === recovered.projectId) ? recovered.projectId : 'inbox')
    setStartAt(recovered.startAt)
    setStartAtDraftPresent(Boolean(recovered.startAt))
    setDeadline(recovered.deadline)
    setDurationUnit('minutes')
    setDurationInput(recovered.plannedDurationMinutes === ''
      ? ''
      : formatDurationInput(recovered.plannedDurationMinutes, 'minutes'))
    setImportance(recovered.importance)
    setUrgencyOverride(recovered.urgencyOverride)
    setThresholdOverride(recovered.urgencyThresholdOverrideHours)
    setTags(recovered.tags)
    setSubtasks(recovered.subtasks.map((subtask) => ({ ...subtask })))
    setSubtaskTitle(recovered.pendingSubtaskTitle)
    setReminders(recovered.reminders.map((reminder) => ({ ...reminder })))
    setStartAtValid(true)
    setDeadlineValid(true)
    setDateInputResetToken((current) => current + 1)
    recoveryDraftRef.current = null
    setRecoveryDraft(null)
    latestJournalTokenRef.current = recoveryDraft.token
    setJournalPresent(true)
    setDraftStorageMessage({
      text: state.projects.some((project) => project.id === recovered.projectId)
        ? 'Черновик восстановлен. Проверьте данные и сохраните задачу.'
        : 'Черновик восстановлен, но удалённый проект заменён на «Входящие».',
      error: false,
    })
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  const save = async () => {
    if (commitInFlightRef.current) return
    if (recoveryDraftRef.current) {
      setDraftStorageMessage({ text: 'Сначала восстановите или удалите найденный черновик.', error: true })
      restoreDraftRef.current?.focus()
      return
    }
    if (!title.trim()) {
      setError('Добавьте название задачи')
      titleRef.current?.focus()
      return
    }
    if (title.length > INPUT_LIMITS.taskTitle) {
      setError(`Название не может быть длиннее ${INPUT_LIMITS.taskTitle} символов`)
      titleRef.current?.focus()
      return
    }
    if (description.length > INPUT_LIMITS.taskDescription || tags.length > INPUT_LIMITS.tagsText) {
      setError('Сократите дополнительный текст или список тегов перед сохранением')
      return
    }
    if (subtasks.length > TASK_DRAFT_MAX_SUBTASKS || reminders.length > TASK_DRAFT_MAX_REMINDERS || attachments.length > 5) {
      setError('Слишком много подзадач, напоминаний или вложений для безопасного сохранения')
      return
    }
    if (!startAtValid || !deadlineValid) {
      setError('Исправьте дату и время перед сохранением')
      editorRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
      return
    }
    if (taskTimingMutationRequiresStart(task, {
      startAt: toIso(startAt),
      deadline: toIso(deadline),
    })) {
      setError(DEADLINE_REQUIRES_START_ERROR)
      editorRef.current?.querySelector<HTMLInputElement>('#task-start-at')?.focus()
      return
    }
    if (plannedDurationMinutes === ''
      || !Number.isInteger(plannedDurationMinutes)
      || plannedDurationMinutes < 1
      || plannedDurationMinutes > MAX_PLANNED_DURATION_MINUTES) {
      setError(DURATION_RANGE_ERROR)
      durationRef.current?.focus()
      return
    }
    const maxDuration = maxDurationUntilLocalMidnight(startAt)
    if (startAt && plannedDurationMinutes > maxDuration) {
      setError(`${DURATION_DAY_ERROR_PREFIX} Для выбранного начала максимум ${formatDuration(maxDuration)}.`)
      durationRef.current?.focus()
      return
    }
    const now = new Date().toISOString()
    const nextTask: Task = {
      id: stableTaskIdRef.current,
      title: title.trim(),
      description: description.trim(),
      projectId,
      startAt: toIso(startAt),
      deadline: toIso(deadline),
      plannedDurationMinutes,
      importance,
      ...(deadline && thresholdOverride !== '' ? { urgencyThresholdOverrideHours: thresholdOverride } : {}),
      ...(deadline && urgencyOverride ? { urgencyOverride } : {}),
      tags: uniqueTags,
      subtasks,
      attachments,
      reminders,
      status: task?.status ?? 'active',
      createdAt: stableCreatedAtRef.current,
      updatedAt: now,
      completedAt: task?.completedAt,
      archivedAt: task?.archivedAt,
      deletedAt: task?.deletedAt,
      previousStatus: task?.previousStatus,
      focusMinutes: task?.focusMinutes ?? 0,
    }
    const journalWrite = persistLatestDraft(true, true)
    if (!journalWrite || journalWrite.status !== 'saved') return

    commitInFlightRef.current = true
    setCommitting(true)
    setError('')
    try {
      await saveTaskDurably(nextTask)
      suppressDraftWriteRef.current = true
      if (clearTaskDraftIfMatches(journalWrite.token)) {
        latestJournalTokenRef.current = undefined
        setJournalPresent(false)
      }
      onClose()
    } catch {
      setError('Не удалось надёжно сохранить задачу. Черновик оставлен — повторите попытку.')
    } finally {
      commitInFlightRef.current = false
      if (mountedRef.current) setCommitting(false)
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save

  const saveFromKeyboard = () => {
    // DateTimePicker and the pending-subtask input commit Enter first. Waiting
    // for that React update prevents the shortcut from saving stale field data.
    queueMicrotask(() => void saveRef.current())
  }

  const moveToTrash = async () => {
    if (!task || commitInFlightRef.current) return
    if (recoveryDraftRef.current) {
      setDraftStorageMessage({ text: 'Сначала восстановите или удалите найденный черновик.', error: true })
      restoreDraftRef.current?.focus()
      return
    }
    const journalWrite = persistLatestDraft(true, true)
    if (!journalWrite || journalWrite.status !== 'saved') return

    commitInFlightRef.current = true
    setCommitting(true)
    setError('')
    try {
      await trashTaskDurably(task.id)
      suppressDraftWriteRef.current = true
      if (clearTaskDraftIfMatches(journalWrite.token)) {
        latestJournalTokenRef.current = undefined
        setJournalPresent(false)
      }
      onClose()
    } catch {
      setError('Не удалось надёжно переместить задачу в корзину. Черновик оставлен — повторите попытку.')
    } finally {
      commitInFlightRef.current = false
      if (mountedRef.current) setCommitting(false)
    }
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

  const previewRecognizedVoiceTranscript = (transcript: string) => {
    setVoiceFailure(undefined)
    previewVoiceTranscript(transcript)
  }

  const applyVoicePreview = () => {
    if (!voicePreview) return
    const parsed = voicePreview
    const hasSpokenDate = Boolean(parsed.startAt || parsed.deadline)
    if (parsed.deadline && deadlineLocked) {
      setError(DEADLINE_REQUIRES_START_ERROR)
      editorRef.current?.querySelector<HTMLInputElement>('#task-start-at')?.focus()
      return
    }
    if (parsed.title) setTitle(parsed.title)
    if (parsed.startAt) {
      updateStartAt(localInput(parsed.startAt))
    }
    if (parsed.deadline) {
      updateDeadline(localInput(parsed.deadline))
    }
    if (hasSpokenDate) {
      setStartAtValid(true)
      setDeadlineValid(true)
      setDateInputResetToken((current) => current + 1)
      setError((current) => current === 'Исправьте дату и время перед сохранением' || isTimingError(current) ? '' : current)
    }
    if (parsed.importance) setImportance(parsed.importance)
    if (parsed.tags.length) {
      const existing = tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      setTags([...new Set([...existing, ...parsed.tags])].join(', '))
    }
    if (parsed.projectHint) {
      const project = state.projects.find((item) => item.name.toLowerCase().includes(parsed.projectHint!.toLowerCase()))
      if (project) setProjectId(project.id)
    }
    setVoiceFailure(undefined)
    setVoiceCommand('')
    setVoicePreview(null)
  }

  const readClipboardFiles = (event: React.ClipboardEvent) => {
    const files = event.clipboardData.files
    if (files.length > 0) void readFiles(files)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closePreservingDraft()}>
      <section
        ref={editorRef}
        className="task-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !(event.target as Element).closest('button')) {
            event.preventDefault()
            saveFromKeyboard()
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closePreservingDraft()
            return
          }
          trapTabKey(event, editorRef.current)
        }}
        onPaste={readClipboardFiles}
      >
        <header className="task-editor__header">
          <div>
            <span className="eyebrow">{task ? 'Редактирование' : 'Новая задача'} · Ctrl/Cmd + Enter</span>
            <h2 id="task-editor-title">{task ? task.title : 'Что нужно сделать?'}</h2>
          </div>
          <button className="icon-button" onClick={closePreservingDraft} aria-label="Закрыть редактор">
            <X />
          </button>
        </header>

        <div ref={contentRef} className="task-editor__content">
          {recoveryDraft && (
            <div data-task-draft-recovery className="voice-preview field--full" role="status" aria-labelledby="task-draft-recovery-title">
              <div>
                <span className="eyebrow">Локальное восстановление</span>
                <strong id="task-draft-recovery-title">Найден несохранённый черновик</strong>
                <span className="voice-preview__chips">
                  <em>{new Date(recoveryDraft.updatedAt).toLocaleString('ru-RU')}</em>
                  {recoveryDraft.savedTaskChanged && <em>Сохранённая задача изменялась позже</em>}
                </span>
              </div>
              <div>
                <button type="button" className="button button--ghost" onClick={removeRecoveryDraft}>Удалить черновик</button>
                <button ref={restoreDraftRef} type="button" className="button button--primary" onClick={restoreRecoveryDraft}>Восстановить</button>
              </div>
            </div>
          )}
          <div className="field field--full">
            <span className="field__label-row">
              <label htmlFor="task-title">Название</label>
              <VoiceCaptureButton onTranscript={previewRecognizedVoiceTranscript} onUnavailable={setVoiceFailure} />
            </span>
            <input id="task-title" ref={titleRef} value={title} maxLength={INPUT_LIMITS.taskTitle} onChange={(event) => setTitle(event.target.value)} placeholder="Например, подготовить отчёт" />
          </div>
          {voiceFailure && (
            <div className="voice-fallback field--full">
              <VoiceCaptureFailureNotice failure={voiceFailure} />
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
                  {voicePreview.startAt && <em>Начало: {new Date(voicePreview.startAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</em>}
                  {voicePreview.deadline && <em>Дедлайн: {new Date(voicePreview.deadline).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</em>}
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
            <textarea value={description} maxLength={INPUT_LIMITS.taskDescription} onChange={(event) => setDescription(event.target.value)} placeholder="Контекст, ссылки и заметки…" rows={3} />
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
          <DateTimePicker inputId="task-start-at" label="Начало" value={startAt} onChange={updateStartAt} onValidityChange={setStartAtValid} onDraftPresenceChange={setStartAtDraftPresent} defaultTime="09:00" resetToken={dateInputResetToken} />
          <div className="field">
            <label htmlFor="task-duration">Длительность</label>
            <div className="inline-add">
              <input
                id="task-duration"
                ref={durationRef}
                type="number"
                inputMode="decimal"
                min={durationUnit === 'minutes' ? 1 : formatDurationInput(1, 'hours')}
                max={durationUnit === 'minutes'
                  ? maxPlannedDurationMinutes
                  : formatDurationInput(maxPlannedDurationMinutes, 'hours')}
                step={durationUnit === 'minutes' ? 1 : 'any'}
                list={`task-duration-${durationUnit}`}
                value={durationInput}
                onChange={(event) => updateDurationInput(event.target.value)}
                aria-invalid={durationHasError}
                aria-describedby="task-duration-hint"
                aria-errormessage={durationHasError ? 'task-editor-error' : undefined}
              />
              <select
                aria-label="Единица длительности"
                value={durationUnit}
                onChange={(event) => updateDurationUnit(event.target.value as DurationUnit)}
              >
                <option value="minutes">минуты</option>
                <option value="hours">часы</option>
              </select>
              <datalist id={`task-duration-${durationUnit}`}>
                {[15, 30, 45, 60, 90, 120, 240, 480, 720, MAX_PLANNED_DURATION_MINUTES]
                  .filter((minutes) => minutes <= maxPlannedDurationMinutes)
                  .map((minutes) => (
                    <option key={minutes} value={formatDurationInput(minutes, durationUnit)}>{formatDuration(minutes)}</option>
                  ))}
              </datalist>
            </div>
            <small id="task-duration-hint">
              {plannedDurationMinutes !== ''
                && Number.isInteger(plannedDurationMinutes)
                && plannedDurationMinutes >= 1
                && plannedDurationMinutes <= MAX_PLANNED_DURATION_MINUTES
                ? `${formatDuration(plannedDurationMinutes)}. `
                : ''}
              {startAt
                ? `Максимум до полуночи: ${formatDuration(maxPlannedDurationMinutes)}.`
                : 'От 1 минуты до 24 часов; начало задаёт положение блока в календаре.'}
            </small>
          </div>
          <DateTimePicker
            label="Дедлайн"
            value={deadline}
            onChange={updateDeadline}
            onValidityChange={setDeadlineValid}
            defaultTime="18:00"
            resetToken={dateInputResetToken}
            disabled={deadlineLocked}
            allowClearWhenDisabled={Boolean(deadline)}
            hint={deadlineLocked
              ? deadline
                ? 'Добавьте начало, чтобы изменить дедлайн; существующий срок можно очистить.'
                : 'Сначала укажите корректное начало задачи.'
              : undefined}
          />
          {deadline && (
            <>
              <div className="field">
                <span>Становится срочной за</span>
                <SelectMenu<number | 'inherit'>
                  label="Порог срочности"
                  value={thresholdOverride === '' ? 'inherit' : thresholdOverride}
                  onChange={(value) => setThresholdOverride(value === 'inherit' ? '' : value)}
                  options={thresholdOptions}
                />
                <small>Эффективный порог: {formatUrgencyThreshold(effectiveThreshold)} до дедлайна</small>
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
            </>
          )}
          <label className="field field--full">
            <span>Теги через запятую</span>
            <input value={tags} maxLength={INPUT_LIMITS.tagsText} onChange={(event) => setTags(event.target.value)} placeholder="работа, фокус, звонки" />
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
              <input value={subtaskTitle} maxLength={INPUT_LIMITS.subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && (event.preventDefault(), addSubtask())} placeholder="Добавить подзадачу" />
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
            <p className="empty-inline">Вложения не входят в аварийный черновик.</p>
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
          {!recoveryDraft && (hasUnsavedChanges || journalPresent) && (
            <div className="field--full">
              <button type="button" className="text-button" disabled={committing} onClick={discardDraftAndClose}>Удалить черновик и закрыть</button>
            </div>
          )}
          {draftStorageMessage && (
            <p className={draftStorageMessage.error ? 'form-error' : 'empty-inline field--full'} role={draftStorageMessage.error ? 'alert' : 'status'}>
              {draftStorageMessage.text}
            </p>
          )}
          {error && <p id="task-editor-error" className="form-error" role="alert">{error}</p>}
        </div>

        <footer className="task-editor__footer">
          {task ? (
            <button className="button button--danger-ghost" disabled={committing || Boolean(recoveryDraft)} onClick={() => void moveToTrash()}><Trash2 size={17} /> {committing ? 'Сохраняем…' : 'В корзину'}</button>
          ) : <span />}
          <div>
            <button className="button button--ghost" onClick={closePreservingDraft}>Закрыть</button>
            <button className="button button--primary" onClick={() => void save()} disabled={committing || Boolean(recoveryDraft)}>{committing ? 'Сохраняем…' : task ? 'Сохранить' : 'Создать задачу'}</button>
          </div>
        </footer>
      </section>
      {previewAttachment && <AttachmentViewer attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />}
    </div>
  )
}
