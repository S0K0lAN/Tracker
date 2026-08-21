import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { getFocusable } from './focusTrap'
import './select-menu.css'

export interface SelectMenuOption<T extends string | number> {
  value: T
  label: string
  description?: string
  icon?: ReactNode
  color?: string
}

interface SelectMenuProps<T extends string | number> {
  label: string
  value: T
  options: SelectMenuOption<T>[]
  onChange(value: T): void
  placeholder?: string
  className?: string
  searchable?: boolean
}

export function SelectMenu<T extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Выберите значение',
  className = '',
  searchable = false,
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((option) => option.value === value)))
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState({ top: 0, left: 0, width: 220 })
  const listboxId = useId()
  const selected = options.find((option) => option.value === value)
  const visibleOptions = searchable && query
    ? options.filter((option) => `${option.label} ${option.description ?? ''}`.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const position = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.max(220, rect.width)
      const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8))
      const estimatedHeight = searchable ? 300 : Math.min(280, options.length * 43 + 10)
      const below = window.innerHeight - rect.bottom
      const top = below >= estimatedHeight || below >= rect.top
        ? rect.bottom + 6
        : Math.max(8, rect.top - estimatedHeight - 6)
      setPopoverStyle({ top, left, width })
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [open, options.length, searchable])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)))
    }
  }, [open, value])

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, visibleOptions.length - 1)))
  }, [visibleOptions.length])

  const select = (option: SelectMenuOption<T>) => {
    onChange(option.value)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const closeAndFocusAdjacent = (backward: boolean) => {
    const trigger = triggerRef.current
    if (!trigger) {
      setOpen(false)
      return
    }
    const scope = trigger.closest<HTMLElement>('[role="dialog"]') ?? document.body
    const focusable = getFocusable(scope).filter((element) => !popoverRef.current?.contains(element))
    const triggerIndex = focusable.indexOf(trigger)
    const target = triggerIndex < 0
      ? trigger
      : backward
        ? focusable[triggerIndex - 1] ?? focusable[focusable.length - 1]
        : focusable[triggerIndex + 1] ?? focusable[0]
    setOpen(false)
    requestAnimationFrame(() => target?.focus())
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab' && open) {
      setOpen(false)
      return
    }
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open && visibleOptions[activeIndex]) select(visibleOptions[activeIndex])
      else setOpen(true)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1
      if (visibleOptions.length) setActiveIndex((current) => (current + direction + visibleOptions.length) % visibleOptions.length)
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open) setOpen(true)
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, visibleOptions.length - 1))
    }
  }

  return (
    <div className={`select-menu ${open ? 'select-menu--open' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="select-menu__trigger"
        role={searchable && open ? undefined : 'combobox'}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={label}
        aria-activedescendant={!searchable && open && visibleOptions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span className="select-menu__value">
          {selected?.color && <i className="select-menu__dot" style={{ background: selected.color }} />}
          {selected?.icon && <span className="select-menu__icon">{selected.icon}</span>}
          <span>
            <strong>{selected?.label ?? placeholder}</strong>
            {selected?.description && <small>{selected.description}</small>}
          </span>
        </span>
        <ChevronDown className="select-menu__chevron" size={17} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div className="select-menu__popover" ref={popoverRef} style={popoverStyle}>
          {searchable && (
            <input
              className="select-menu__search"
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Tab') {
                  event.preventDefault()
                  event.stopPropagation()
                  closeAndFocusAdjacent(event.shiftKey)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  setOpen(false)
                  requestAnimationFrame(() => triggerRef.current?.focus())
                  return
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const direction = event.key === 'ArrowDown' ? 1 : -1
                  if (visibleOptions.length) setActiveIndex((current) => (current + direction + visibleOptions.length) % visibleOptions.length)
                }
                if (event.key === 'Enter' && visibleOptions[activeIndex]) {
                  event.preventDefault()
                  select(visibleOptions[activeIndex])
                }
              }}
              placeholder={`Найти: ${label.toLowerCase()}`}
              aria-label={`Поиск: ${label.toLowerCase()}`}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={visibleOptions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
            />
          )}
          <div className="select-menu__options" id={listboxId} role="listbox" aria-label={label}>
          {visibleOptions.map((option, index) => (
            <button
              type="button"
              id={`${listboxId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={`select-menu__option ${index === activeIndex ? 'is-active' : ''}`}
              key={option.value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => select(option)}
            >
              {option.color && <i className="select-menu__dot" style={{ background: option.color }} />}
              {option.icon && <span className="select-menu__icon">{option.icon}</span>}
              <span>
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value && <Check className="select-menu__check" size={17} aria-hidden="true" />}
            </button>
          ))}
          {visibleOptions.length === 0 && <p className="select-menu__empty">Ничего не найдено</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
