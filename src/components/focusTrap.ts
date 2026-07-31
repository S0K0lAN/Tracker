import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      !element.hidden
      && element.getAttribute('aria-hidden') !== 'true'
      && !element.closest('[inert]'),
  )
}

export function trapTabKey(event: ReactKeyboardEvent, container: HTMLElement | null) {
  if (event.key !== 'Tab') return
  const focusable = getFocusable(container)
  if (!focusable.length) {
    event.preventDefault()
    container?.focus()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (!container?.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

export function setInert(elements: Iterable<Element>, inert: boolean) {
  for (const element of elements) {
    if (inert) element.setAttribute('inert', '')
    else element.removeAttribute('inert')
  }
}
