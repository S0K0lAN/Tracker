import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, X } from 'lucide-react'
import { trapTabKey } from './focusTrap'
import './date-time-picker.css'

const monthTitle = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' })
const weekdayLabels = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс']

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function isValidDateParts(year: number, month: number, day: number, hours: number, minutes: number) {
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0)
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hours
    && date.getMinutes() === minutes
}

function fromParts(year: number, month: number, day: number, hours: number, minutes: number) {
  if (!isValidDateParts(year, month, day, hours, minutes)) return null
  return `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}`
}

export function toLocalDateTimeValue(date: Date) {
  return fromParts(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ) ?? ''
}

export function parseDateTimeInput(
  input: string,
  reference = new Date(),
  defaultTime = '09:00',
): string | null {
  const value = input.trim().replace(/\s*,\s*/, ' ').replace(/\s+/g, ' ')
  if (!value) return ''

  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})(?::|\.)(\d{1,2}))?$/)
  const local = value.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2}|\d{4}))?(?:\s+(\d{1,2})(?::|\.)(\d{1,2}))?$/)
  const [fallbackHours, fallbackMinutes] = defaultTime.split(':').map(Number)

  if (iso) {
    return fromParts(
      Number(iso[1]),
      Number(iso[2]),
      Number(iso[3]),
      iso[4] === undefined ? fallbackHours : Number(iso[4]),
      iso[5] === undefined ? fallbackMinutes : Number(iso[5]),
    )
  }
  if (!local) return null

  let year = local[3] ? Number(local[3]) : reference.getFullYear()
  if (year < 100) year += 2000
  return fromParts(
    year,
    Number(local[2]),
    Number(local[1]),
    local[4] === undefined ? fallbackHours : Number(local[4]),
    local[5] === undefined ? fallbackMinutes : Number(local[5]),
  )
}

export function formatDateTimeInput(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return ''
  return `${match[3]}.${match[2]}.${match[1]}, ${match[4]}:${match[5]}`
}

export function formatNumericDateTimeDraft(input: string) {
  if (/[-/]/.test(input) || /[A-Za-zА-Яа-я]/.test(input)) return input
  const digits = input.replace(/\D/g, '').slice(0, 12)
  if (!digits) return ''

  let result = digits.slice(0, 2)
  if (digits.length >= 2) result += '.'
  result += digits.slice(2, 4)
  if (digits.length >= 4) result += '.'
  result += digits.slice(4, 8)
  if (digits.length >= 8) result += ', '
  result += digits.slice(8, 10)
  if (digits.length >= 10) result += ':'
  result += digits.slice(10, 12)
  return result
}

function dateFromLocalValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

export function DateTimePicker({
  label,
  value,
  onChange,
  onValidityChange,
  defaultTime = '09:00',
  resetToken = 0,
}: {
  label: string
  value: string
  onChange(value: string): void
  onValidityChange?(valid: boolean): void
  defaultTime?: string
  resetToken?: number
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => formatDateTimeInput(value))
  const [invalid, setInvalid] = useState(false)
  const [anchor, setAnchor] = useState(() => dateFromLocalValue(value) ?? new Date())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const [popoverStyle, setPopoverStyle] = useState({ top: 0, left: 0, width: 330 })
  const selected = dateFromLocalValue(value)
  const fieldNoun = label === 'Начало' ? 'начала' : label === 'Дедлайн' ? 'дедлайна' : label.toLocaleLowerCase('ru-RU')

  useEffect(() => {
    setDraft(formatDateTimeInput(value))
    setInvalid(false)
    const date = dateFromLocalValue(value)
    if (date) setAnchor(date)
  }, [resetToken, value])

  useEffect(() => {
    if (!open) return
    const focusFrame = requestAnimationFrame(() => {
      const popover = popoverRef.current
      const target = popover?.querySelector<HTMLButtonElement>('.date-time-popover__days .is-selected, .date-time-popover__days .is-today')
        ?? popover?.querySelector<HTMLButtonElement>('.date-time-popover__days button')
      target?.focus()
    })
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('pointerdown', closeOutside)
    }
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(340, window.innerWidth - 16)
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
      const estimatedHeight = 410
      const below = window.innerHeight - rect.bottom
      const top = below >= estimatedHeight || below >= rect.top
        ? rect.bottom + 7
        : Math.max(8, rect.top - estimatedHeight - 7)
      setPopoverStyle({ top, left, width })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open])

  const days = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const offset = (first.getDay() + 6) % 7
    return Array.from({ length: 42 }, (_, index) => (
      new Date(anchor.getFullYear(), anchor.getMonth(), index - offset + 1)
    ))
  }, [anchor])

  const setValue = (next: Date) => {
    const nextValue = toLocalDateTimeValue(next)
    onChange(nextValue)
    setDraft(formatDateTimeInput(nextValue))
    setInvalid(false)
    onValidityChange?.(true)
    setAnchor(next)
  }

  const chooseRelativeDay = (offset: number) => {
    const next = new Date()
    next.setDate(next.getDate() + offset)
    const [hours, minutes] = defaultTime.split(':').map(Number)
    next.setHours(hours, minutes, 0, 0)
    setValue(next)
    setOpen(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const commitManual = () => {
    const parsed = parseDateTimeInput(draft, new Date(), defaultTime)
    if (parsed === null) {
      setInvalid(true)
      onValidityChange?.(false)
      return false
    }
    onChange(parsed)
    setDraft(formatDateTimeInput(parsed))
    setInvalid(false)
    onValidityChange?.(true)
    return true
  }

  const selectDay = (day: Date) => {
    const [hours, minutes] = selected
      ? [selected.getHours(), selected.getMinutes()]
      : defaultTime.split(':').map(Number)
    const next = new Date(day)
    next.setHours(hours, minutes, 0, 0)
    setValue(next)
  }

  const clear = () => {
    onChange('')
    setDraft('')
    setInvalid(false)
    onValidityChange?.(true)
  }

  return (
    <div className="field date-time-field" ref={rootRef}>
      <span id={labelId}>{label}</span>
      <div className={`date-time-field__control ${invalid ? 'is-invalid' : ''}`}>
        <CalendarDays size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          aria-labelledby={labelId}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${labelId}-error` : `${labelId}-hint`}
          value={draft}
          inputMode="numeric"
          placeholder="ДД.ММ.ГГГГ, ЧЧ:ММ"
          onChange={(event) => {
            const nextDraft = formatNumericDateTimeDraft(event.target.value)
            setDraft(nextDraft)
            setInvalid(false)
            if (!nextDraft.trim()) {
              onChange('')
              onValidityChange?.(true)
            } else {
              onValidityChange?.(parseDateTimeInput(nextDraft, new Date(), defaultTime) !== null)
            }
          }}
          onBlur={commitManual}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              if (commitManual()) inputRef.current?.blur()
            }
          }}
        />
        {value && <button type="button" className="date-time-field__clear" onClick={clear} aria-label={`Очистить дату ${fieldNoun}`}><X size={14} /></button>}
        <button
          ref={triggerRef}
          type="button"
          className="date-time-field__toggle"
          aria-label={`Открыть календарь ${fieldNoun}`}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        ><ChevronRight size={16} /></button>
      </div>
      <small id={`${labelId}-hint`} className="date-time-field__hint">Например: 31.07.2026, 18:30</small>
      {invalid && <small id={`${labelId}-error`} className="date-time-field__error" role="alert">Проверьте дату и время</small>}

      {open && createPortal(
        <section
          ref={popoverRef}
          className="date-time-popover"
          style={popoverStyle}
          role="dialog"
          aria-label={`Выбор даты: ${label}`}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') {
              event.preventDefault()
              setOpen(false)
              requestAnimationFrame(() => triggerRef.current?.focus())
              return
            }
            trapTabKey(event, popoverRef.current)
          }}
        >
          <header>
            <button type="button" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))} aria-label="Предыдущий месяц"><ChevronLeft /></button>
            <strong>{monthTitle.format(anchor)}</strong>
            <button type="button" onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))} aria-label="Следующий месяц"><ChevronRight /></button>
          </header>
          <div className="date-time-popover__weekdays" aria-hidden="true">
            {weekdayLabels.map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="date-time-popover__days">
            {days.map((day) => {
              const isSelected = Boolean(selected && sameDay(day, selected))
              const isToday = sameDay(day, new Date())
              return (
                <button
                  type="button"
                  key={`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`}
                  className={`${day.getMonth() !== anchor.getMonth() ? 'is-muted' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => selectDay(day)}
                  aria-label={day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
                  aria-pressed={isSelected}
                >{day.getDate()}</button>
              )
            })}
          </div>
          <div className="date-time-popover__quick">
            <button type="button" onClick={() => chooseRelativeDay(0)}>Сегодня</button>
            <button type="button" onClick={() => chooseRelativeDay(1)}>Завтра</button>
            <button type="button" onClick={() => chooseRelativeDay(7)}>Через неделю</button>
          </div>
          <label className="date-time-popover__time">
            <Clock3 size={16} aria-hidden="true" />
            <span>Время</span>
            <input
              type="time"
              value={selected ? `${pad(selected.getHours())}:${pad(selected.getMinutes())}` : defaultTime}
              onChange={(event) => {
                const [hours, minutes] = event.target.value.split(':').map(Number)
                const next = selected ? new Date(selected) : new Date()
                next.setHours(hours, minutes, 0, 0)
                setValue(next)
              }}
            />
          </label>
          <footer>
            <button type="button" className="button button--ghost" onClick={clear}>Без даты</button>
            <button type="button" className="button button--primary" onClick={() => {
              setOpen(false)
              requestAnimationFrame(() => triggerRef.current?.focus())
            }}><Check size={16} /> Готово</button>
          </footer>
        </section>,
        document.body,
      )}
    </div>
  )
}
